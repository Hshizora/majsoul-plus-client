/*eslint no-console: ["error", { allow: ["warn", "error"] }] */

const express = require('express')
const server = express()
const Util = require('./Util.js')
const configs = require('./configs')
const fs = require('fs')
const path = require('path')

const https = require('https')

const electron = require('electron')
const { app: electronApp, BrowserWindow, ipcMain } = electron
const { Menu, MenuItem } = electron

let userConfigs = require(configs.USER_CONFIG_PATH)

if (userConfigs.chromium.isInProcessGpuOn) {
  electronApp.commandLine.appendSwitch('in-process-gpu')
}

const sererHttps = https.createServer(
  {
    key: fs.readFileSync(path.join(__dirname, './certificate/key.pem')),
    cert: fs.readFileSync(path.join(__dirname, './certificate/cert.crt'))
  },
  server
)

if (
  (() => {
    try {
      if (userConfigs.chromium['isHardwareAccelerationDisable'] === true) {
        return true
      }
    } catch (err) {
      return false
    }
    return false
  })()
) {
  electronApp.disableHardwareAcceleration()
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

server.get('*', Util.processRequest)

electronApp.commandLine.appendSwitch('ignore-certificate-errors')
electronApp.commandLine.appendSwitch(
  'autoplay-policy',
  'no-user-gesture-required'
)

// 当所有窗口被关闭了，退出。
electronApp.on('window-all-closed', () => {
  // 在 OS X 上，通常用户在明确地按下 Cmd + Q 之前
  // 应用会保持活动状态
  // if (process.platform !== 'darwin') {
  electronApp.quit()
  // }
})

// 阻止证书验证
electronApp.on(
  'certificate-error',
  (event, webContents, url, error, certificate, callback) => {
    event.preventDefault()
    callback(true)
  }
)

const windowControl = {
  windowMap: { toolsMap: {} },
  _getGameWindowTitle: () => {
    const titles = [
      {
        text: '雀魂Plus',
        weight: 200
      },
      {
        text: '喵喵喵！ - 喵喵喵？喵！喵喵喵！喵~~',
        weight: 1
      }
    ]
    let sumWeight = titles.reduce((last, value) => last + value.weight, 0)
    let randomResult = (Math.random() * sumWeight) >> 0
    const index = titles.reduce((last, value, index) => {
      if (Number.isInteger(last)) {
        return last
      }
      if ((randomResult -= value.weight) <= 0) {
        return index
      }
      return null
    }, null)
    return titles[index].text
  },

  _getExecuteScripts: () => {
    // const executeRootDir = path.join(__dirname, configs.EXECUTES_DIR)
    let executeScripts
    try {
      const data = fs.readFileSync(configs.EXECUTES_CONFIG_PATH)
      executeScripts = JSON.parse(data.toString('utf-8'))
    } catch (error) {
      console.error(error)
      executeScripts = []
    }
    return executeScripts
  },

  electronReady: () => {
    return new Promise(resolve => electronApp.once('ready', resolve))
  },

  /**
   * @param {https.Server} sererHttps
   */
  initLocalMirrorServer: (sererHttps, port) => {
    return new Promise(resolve => {
      sererHttps.listen(port)
      sererHttps.on('listening', resolve)
      sererHttps.on('error', err => {
        if (err.code === 'EADDRINUSE') {
          console.warn('Port in use, retrying...')
          sererHttps.close()
          sererHttps.listen(0)
        }
      })
    })
  },
  initManagerWindow: managerWindowConfig => {
    const config = {
      ...managerWindowConfig
    }
    // hack macOS config
    if (process.platform === 'darwin') {
      config.frame = true
      config.titleBarStyle = 'hidden'
    }

    config.width *= userConfigs.window.zoomFactor
    config.height *= userConfigs.window.zoomFactor

    const managerWindow = new BrowserWindow(config)

    managerWindow.once('ready-to-show', () => {
      managerWindow.webContents.setZoomFactor(userConfigs.window.zoomFactor)
      managerWindow.show()
    })

    managerWindow.on('page-title-updated', evt => evt.preventDefault())
    managerWindow.loadURL(
      'file://' + path.join(__dirname, '/manager/index.html')
    )

    // Add environment config to open developer tools
    if (process.env.NODE_ENV === 'development') {
      managerWindow.openDevTools({ mode: 'detach' })
    }

    windowControl.windowMap['manager'] = managerWindow
  },

  initGameWindow: gameWindowConfig => {
    const config = {
      ...gameWindowConfig,
      title: windowControl._getGameWindowTitle()
    }
    const gameWindow = new BrowserWindow(config)
    gameWindow.on('page-title-updated', event => event.preventDefault())
    gameWindow.on('resize', () => {
      gameWindow.webContents.send('window-resize', gameWindow.getBounds())
    })
    gameWindow.on('move', () => {
      gameWindow.webContents.send('window-resize', gameWindow.getBounds())
    })
    gameWindow.on('moved', () => {
      gameWindow.webContents.send('window-resize', gameWindow.getBounds())
    })
    gameWindow.on('closed', () => {
      Util.shutoffPlayer()
    })
    Util.initPlayer()
    gameWindow.webContents.on('crashed', () =>
      console.warn('web contents crashed')
    )
    gameWindow.once('ready-to-show', () => {
      gameWindow.webContents.setZoomFactor(1)
      gameWindow.show()
    })
    gameWindow.webContents.on('console-message', (
      evt,
      level,
      msg /*, line, sourceId  */
    ) => {
      if (level !== 'log') {
        console.warn('Console', msg)
      }
    })
    // gameWindow.loadURL(`https://localhost:${sererHttps.address().port}/0/`)
    gameWindow.loadURL('file://' + path.join(__dirname, 'bin/main/index.html'))

    // Add environment config to open developer tools
    if (process.env.NODE_ENV === 'development') {
      gameWindow.openDevTools({ mode: 'detach' })
    }

    // 设置一个菜单
    const gameWindowMenu = new Menu()
    gameWindowMenu.append(
      new MenuItem({
        label: '游戏',
        role: 'services',
        submenu: [
          new MenuItem({
            label: '截图',
            accelerator: 'F12',
            click: (menuItem, browserWindow) => {
              Util.takeScreenshot(browserWindow.webContents)
            }
          }),
          new MenuItem({
            label: '截图',
            accelerator: 'CmdOrCtrl+P',
            enabled: true,
            // visible: false,
            click: (menuItem, browserWindow) => {
              Util.takeScreenshot(browserWindow.webContents)
            }
          }),
          new MenuItem({
            label: '退出游戏',
            accelerator: 'Alt+F4',
            click: (menuItem, browserWindow) => {
              browserWindow.close()
            }
          })
        ]
      })
    )
    gameWindowMenu.append(
      new MenuItem({
        label: '窗口',
        role: 'window',
        submenu: [
          new MenuItem({
            label: '全屏',
            accelerator: 'F11',
            click: (menuItem, browserWindow) => {
              if (!userConfigs.window.isKioskModeOn) {
                browserWindow.setFullScreen(!browserWindow.isFullScreen())
              } else {
                browserWindow.setKiosk(!browserWindow.isKiosk())
              }
            }
          }),
          new MenuItem({
            label: '全屏',
            accelerator: 'F5',
            enabled: true,
            visible: false,
            click: (menuItem, browserWindow) => {
              if (!userConfigs.window.isKioskModeOn) {
                browserWindow.setFullScreen(!browserWindow.isFullScreen())
              } else {
                browserWindow.setKiosk(!browserWindow.isKiosk())
              }
            }
          }),
          new MenuItem({
            label: '退出全屏',
            accelerator: 'Esc',
            click: (menuItem, browserWindow) => {
              if (browserWindow.isFullScreen()) {
                browserWindow.setFullScreen(false)
                return
              }
              if (browserWindow.isKiosk()) {
                browserWindow.setKiosk(false)
              }
            }
          })
        ]
      })
    )
    gameWindowMenu.append(
      new MenuItem({
        label: '更多',
        submenu: [
          new MenuItem({
            label: '开发者工具',
            accelerator: 'CmdOrCtrl+I',
            click: (menuItem, browserWindow) => {
              browserWindow.openDevTools({ mode: 'detach' })
            }
          })
        ]
      })
    )
    Menu.setApplicationMenu(gameWindowMenu)

    windowControl.windowMap['game'] = gameWindow
  },

  closeManagerWindow: () => {
    const managerWindow = windowControl.windowMap['manager']
    managerWindow && managerWindow.close()
  },

  addAppListener: () => {
    ipcMain.on('application-message', (evt, ...args) => {
      if (args && args.length > 0) {
        switch (args[0]) {
          case 'start-game': {
            windowControl
              .initLocalMirrorServer(sererHttps, configs.SERVER_PORT)
              .then(() => {
                windowControl.initGameWindow(configs.GAME_WINDOW_CONFIG)
                windowControl.closeManagerWindow()
              })
            break
          }
          case 'start-tool': {
            const toolInfo = args[1]
            if (!toolInfo.windowOptions) {
              toolInfo.windowOption = {}
            }
            const toolConfig = {
              ...configs.TOOL_WINDOW_CONFIG,
              ...toolInfo.windowOptions
            }
            const indexPage = toolInfo.index ? toolInfo.index : 'index.html'
            toolConfig.parent = windowControl.windowMap['manager']

            const toolWindow = new BrowserWindow(toolConfig)

            windowControl.windowMap.toolsMap[toolInfo.filesDir] = toolWindow

            if (process.env.NODE_ENV === 'development') {
              toolWindow.openDevTools({ mode: 'detach' })
            }

            toolWindow.loadURL(
              'file://' + path.join(toolInfo.filesDir, indexPage)
            )
            break
          }
          case 'update-user-config': {
            userConfigs = JSON.parse(fs.readFileSync(configs.USER_CONFIG_PATH))
            windowControl.windowMap['manager'].setContentSize(
              configs.MANAGER_WINDOW_CONFIG.width *
                userConfigs.window.zoomFactor,
              configs.MANAGER_WINDOW_CONFIG.height *
                userConfigs.window.zoomFactor
            )
            windowControl.windowMap['manager'].webContents.setZoomFactor(
              userConfigs.window.zoomFactor
            )
            break
          }
          case 'take-screenshot': {
            const buffer = args[1]
            Util.writeFile(
              path.join(
                electron.app.getPath('pictures'),
                electron.app.getName(),
                Date.now() + '.png'
              ),
              buffer
            )
            break
          }
          default:
            break
        }
      }
    })
    ipcMain.on('main-loader-message', (evt, ...args) => {
      if (args && args.length > 0) {
        switch (args[0]) {
          case 'main-loader-ready': {
            windowControl.windowMap['game'].webContents.send(
              'server-port-load',
              sererHttps.address().port
            )
            break
          }
          case 'server-port-loaded': {
            const executeScripts = windowControl._getExecuteScripts()
            windowControl.windowMap['game'].webContents.send(
              'executes-load',
              executeScripts
            )
            break
          }
          case 'executes-loaded': {
            windowControl.windowMap['game'].webContents.send(
              'load-url',
              `https://localhost:${sererHttps.address().port}/0/`
            )
            break
          }
          default:
            break
        }
      }
    })
  },

  start: () => {
    windowControl.electronReady().then(() => {
      Menu.setApplicationMenu(null)
      windowControl.addAppListener()

      windowControl.initManagerWindow({ ...configs.MANAGER_WINDOW_CONFIG })
    })
  }
}
windowControl.start()

process.on('uncaughtException', err => {
  console.error(err)
})
