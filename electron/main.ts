import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { P4Service } from './p4/p4Service'

let mainWindow: BrowserWindow | null = null
const p4Service = new P4Service()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    show: false
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

ipcMain.handle('p4:reopenFiles', async (_, files: string[], changelist: number | 'default') => {
  return p4Service.reopenFiles(files, changelist)
})

ipcMain.handle('p4:createChangelist', async (_, description: string) => {
  return p4Service.createChangelist(description)
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
