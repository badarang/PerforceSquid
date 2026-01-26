import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { P4Service } from './p4/p4Service'

let mainWindow: BrowserWindow | null = null
const p4Service = new P4Service()
import fs from 'fs'

function createWindow() {
  const isDev = process.env.VITE_DEV_SERVER_URL;
  
  // Restore window state
  let windowState = { width: 1280, height: 720, x: undefined, y: undefined }
  const statePath = path.join(app.getPath('userData'), 'window-state.json')
  
  try {
    if (fs.existsSync(statePath)) {
      const savedState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      windowState = { ...windowState, ...savedState }
    }
  } catch (e) {
    // Ignore error
  }

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

app.whenReady().then(createWindow)

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

ipcMain.handle('p4:revert', async (_, files: string[]) => {
  return p4Service.revert(files)
})

ipcMain.handle('p4:revertUnchanged', async () => {
  return p4Service.revertUnchanged()
})

ipcMain.handle('p4:shelve', async (_, changelist: number) => {
  return p4Service.shelve(changelist)
})

ipcMain.handle('p4:unshelve', async (_, changelist: number) => {
  return p4Service.unshelve(changelist)
})

ipcMain.handle('p4:submittedChanges', async (_, depotPath: string, maxChanges?: number) => {
  return p4Service.getSubmittedChanges(depotPath, maxChanges)
})

ipcMain.handle('p4:describeChangelist', async (_, changelist: number) => {
  return p4Service.describeChangelist(changelist)
})

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
