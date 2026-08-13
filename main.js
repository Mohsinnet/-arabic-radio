const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    icon: path.join(__dirname, "icon.png"), // اختياري، احذف هذا السطر إن لم تضف أيقونة
    autoHideMenuBar: true,
    backgroundColor: "#0d2226",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
