import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { P4Service } from './p4/p4Service'
import { JiraService } from './jira/jiraService'
import fs from 'fs'
import { spawn } from 'child_process'

let mainWindow: BrowserWindow | null = null
const p4Service = new P4Service()
const jiraService = new JiraService()

interface IntegrationSettings {
  jiraBotPath?: string
  defaultReviewers?: string[]
  reviewLinks?: Record<string, string>
}

function getIntegrationSettingsPath(): string {
  return path.join(app.getPath('userData'), 'integration-settings.json')
}

function loadIntegrationSettings(): IntegrationSettings {
  const settingsPath = getIntegrationSettingsPath()
  try {
    if (!fs.existsSync(settingsPath)) {
      return {}
    }
    const raw = fs.readFileSync(settingsPath, 'utf8')
    return JSON.parse(raw) as IntegrationSettings
  } catch {
    return {}
  }
}

function saveIntegrationSettings(settings: IntegrationSettings): void {
  const settingsPath = getIntegrationSettingsPath()
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  } catch {
    // Ignore persistence errors
  }
}

function updateIntegrationSettings(partial: Partial<IntegrationSettings>): IntegrationSettings {
  const existing = loadIntegrationSettings()
  const next: IntegrationSettings = { ...existing, ...partial }
  saveIntegrationSettings(next)
  return next
}

function createWindow() {
  const isDev = process.env.VITE_DEV_SERVER_URL;
  
  // Restore window state
  let windowState = { width: 1280, height: 800, x: undefined, y: undefined }
  const statePath = path.join(app.getPath('userData'), 'window-state.json')
  
  /* Temporarily disable state restore to force correct size for user
  try {
    if (fs.existsSync(statePath)) {
      const savedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      windowState = { ...windowState, ...savedState }
    }
  } catch (e) {
    // Ignore error
  }
  */

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(isDev ? process.cwd() : process.resourcesPath, 'build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    show: false
  })

  // Save window state on close
  mainWindow.on('close', () => {
    if (!mainWindow) return
    const bounds = mainWindow.getBounds()
    try {
      fs.writeFileSync(statePath, JSON.stringify(bounds))
    } catch (e) {
      // Ignore
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // DevTools disabled by default - use Ctrl+Shift+I to open manually
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  const settings = loadIntegrationSettings()
  if (settings.jiraBotPath) {
    jiraService.setPath(settings.jiraBotPath)
  }
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// IPC Handlers
ipcMain.handle('p4:clients', async () => {
  return p4Service.getClients()
})

ipcMain.handle('p4:createClient', async (_, client) => {
  return p4Service.createClient(client)
})

ipcMain.handle('p4:setClient', async (_, clientName: string) => {
  p4Service.setClient(clientName)
  return { success: true }
})

ipcMain.handle('p4:getClient', async () => {
  return p4Service.getClient()
})

ipcMain.handle('p4:info', async () => {
  return p4Service.getInfo()
})

ipcMain.handle('p4:opened', async () => {
  return p4Service.getOpenedFiles()
})

ipcMain.handle('p4:diff', async (_, filePath: string) => {
  return p4Service.getDiff(filePath)
})

ipcMain.handle('p4:changelists', async () => {
  return p4Service.getChangelists()
})

ipcMain.handle('p4:submit', async (_, changelist: number, description: string) => {
  return p4Service.submit(changelist, description)
})

ipcMain.handle('p4:sync', async (_, filePath?: string) => {
  return p4Service.sync(filePath)
})

ipcMain.handle('p4:reconcileOfflineSmart', async (event) => {
  return p4Service.reconcileOfflineSmart((progress) => {
    event.sender.send('p4:reconcileProgress', progress)
  })
})

ipcMain.handle('p4:reconcileOfflineAll', async (event) => {
  return p4Service.reconcileOfflineAll((progress) => {
    event.sender.send('p4:reconcileProgress', progress)
  })
})

ipcMain.handle('p4:revert', async (_, files: string[]) => {
  return p4Service.revert(files)
})

ipcMain.handle('p4:revertUnchanged', async () => {
  return p4Service.revertUnchanged()
})

ipcMain.handle('p4:shelve', async (_, changelist: number) => {
  return p4Service.shelve(changelist)
})

ipcMain.handle('p4:unshelve', async (_, changelist: number, files?: string[]) => {
  return p4Service.unshelve(changelist, files)
})

ipcMain.handle('p4:submittedChanges', async (_, depotPath: string, maxChanges?: number) => {
  return p4Service.getSubmittedChanges(depotPath, maxChanges)
})

ipcMain.handle(
  'p4:describeChangelist',
  async (_, changelist: number, options?: { includeDiff?: boolean }) => {
    return p4Service.describeChangelist(changelist, options)
  }
)

ipcMain.handle('p4:getClientStream', async () => {
  return p4Service.getClientStream()
})

ipcMain.handle('p4:switchStream', async (_, streamPath: string) => {
  return p4Service.switchStream(streamPath)
})

ipcMain.handle('p4:getCurrentDepot', async () => {
  return p4Service.getCurrentDepot()
})

ipcMain.handle('p4:getSwarmUrl', async () => {
  return p4Service.getSwarmUrl()
})

ipcMain.handle('p4:createSwarmReview', async (_, changelist: number, reviewers: string[], description?: string) => {
  return p4Service.createSwarmReview(changelist, reviewers, description)
})

ipcMain.handle('p4:users', async () => {
  return p4Service.getUsers()
})

ipcMain.handle('p4:reopenFiles', async (_, files: string[], changelist: number | 'default') => {
  return p4Service.reopenFiles(files, changelist)
})

ipcMain.handle('p4:createChangelist', async (_, description: string) => {
  return p4Service.createChangelist(description)
})

ipcMain.handle('p4:editChangelist', async (_, changelist: number, description: string) => {
  return p4Service.editChangelist(changelist, description)
})

ipcMain.handle('p4:deleteChangelist', async (_, changelist: number) => {
  return p4Service.deleteChangelist(changelist)
})

ipcMain.handle('p4:revertAndDeleteChangelist', async (_, changelist: number) => {
  return p4Service.revertAndDeleteChangelist(changelist)
})

ipcMain.handle('p4:getOrCreateJunkChangelist', async () => {
  return p4Service.getOrCreateJunkChangelist()
})

ipcMain.handle('p4:annotate', async (_, filePath: string) => {
  return p4Service.annotate(filePath)
})

ipcMain.handle('p4:readFile', async (_, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, message: 'File not found' }
    }
    const content = fs.readFileSync(filePath, 'utf8')
    return { success: true, content }
  } catch (err: any) {
    return { success: false, message: err.message }
  }
})

ipcMain.handle('p4:saveFile', async (_, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8')
    return { success: true }
  } catch (err: any) {
    return { success: false, message: err.message }
  }
})

// Stream Graph IPC Handlers
ipcMain.handle('p4:getDepots', async () => {
  return p4Service.getDepots()
})

ipcMain.handle('p4:getStreams', async (_, depot?: string) => {
  return p4Service.getStreams(depot)
})

ipcMain.handle('p4:getStreamSpec', async (_, streamPath: string) => {
  return p4Service.getStreamSpec(streamPath)
})

ipcMain.handle('p4:getAllWorkspaces', async () => {
  return p4Service.getAllWorkspaces()
})

ipcMain.handle('p4:getWorkspacesByStream', async (_, streamPath: string) => {
  return p4Service.getWorkspacesByStream(streamPath)
})

ipcMain.handle('p4:getWorkspaceDetails', async (_, clientName: string) => {
  return p4Service.getWorkspaceDetails(clientName)
})

ipcMain.handle('p4:getStreamGraphData', async (_, depot: string) => {
  return p4Service.getStreamGraphData(depot)
})

ipcMain.handle('p4:getInterchanges', async (_, fromStream: string, toStream: string) => {
  return p4Service.getInterchanges(fromStream, toStream)
})

// Settings IPC Handlers
ipcMain.handle('settings:getAutoLaunch', () => {
  const settings = app.getLoginItemSettings()
  return settings.openAtLogin
})

ipcMain.handle('settings:setAutoLaunch', (_, enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe')
  })
  return { success: true }
})

ipcMain.handle('settings:getDefaultReviewers', () => {
  const settings = loadIntegrationSettings()
  return Array.isArray(settings.defaultReviewers) ? settings.defaultReviewers : []
})

ipcMain.handle('settings:setDefaultReviewers', (_, reviewers: string[]) => {
  const normalized = Array.isArray(reviewers)
    ? reviewers.map((r) => String(r || '').trim()).filter(Boolean)
    : []
  updateIntegrationSettings({ defaultReviewers: normalized })
  return { success: true }
})

ipcMain.handle('settings:getReviewLink', (_, changelist: number) => {
  const settings = loadIntegrationSettings()
  const links = settings.reviewLinks || {}
  const value = links[String(changelist)]
  return typeof value === 'string' && value.trim() ? value : null
})

ipcMain.handle('settings:setReviewLink', (_, changelist: number, reviewUrl: string) => {
  const settings = loadIntegrationSettings()
  const links = { ...(settings.reviewLinks || {}) }
  links[String(changelist)] = String(reviewUrl || '').trim()
  updateIntegrationSettings({ reviewLinks: links })
  return { success: true }
})

// JiraBot IPC Handlers
ipcMain.handle('jira:getPath', async () => {
  return jiraService.getPath()
})

ipcMain.handle('jira:setPath', async (_, targetPath: string) => {
  jiraService.setPath(targetPath)
  updateIntegrationSettings({ jiraBotPath: targetPath })
  return { success: true }
})

ipcMain.handle('jira:getStatus', async () => {
  return jiraService.getStatus()
})

ipcMain.handle('jira:recommend', async (_, project: string, limit: number = 10) => {
  return jiraService.recommend(project, limit)
})

ipcMain.handle('jira:similar', async (_, ticketOrUrl: string, threshold: number = 0.3) => {
  return jiraService.similar(ticketOrUrl, threshold)
})

ipcMain.handle('jira:track', async (_, project: string, assignee: string, limit: number = 20) => {
  return jiraService.track(project, assignee, limit)
})

ipcMain.handle('jira:openInChrome', async (_, targetUrl: string) => {
  const chromeCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ].filter(Boolean)

  const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate))
  if (chromePath) {
    const child = spawn(chromePath, [targetUrl], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return { success: true }
  }

  await shell.openExternal(targetUrl)
  return { success: true, fallback: true }
})

// Dialog Handlers
import { dialog } from 'electron'

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  if (result.canceled) {
    return null
  }
  return result.filePaths[0]
})

ipcMain.handle('window:openDiffWindow', async (_, file: any, mode: string = 'diff') => {
  const diffWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `Diff: ${file.clientFile || file.depotFile}`,
    icon: path.join(process.env.VITE_DEV_SERVER_URL ? process.cwd() : process.resourcesPath, 'build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1e1e1e',
    show: false
  })
  diffWindow.setMenu(null)

  const fileParam = encodeURIComponent(JSON.stringify(file))
  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}/#diff?file=${fileParam}&mode=${mode}`
    : `file://${path.join(__dirname, '../dist/index.html')}#diff?file=${fileParam}&mode=${mode}`

  diffWindow.loadURL(url)
  diffWindow.once('ready-to-show', () => diffWindow.show())
})
