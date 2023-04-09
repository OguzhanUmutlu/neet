const {app, globalShortcut, BrowserWindow, ipcMain} = require("electron");
const fs = require("fs");
if (!fs.existsSync("./cache.json")) fs.writeFileSync("./cache.json", JSON.stringify({
    scripts: {}
}));

let cache = require("./cache.json");
module.exports = {cache: () => cache};
const path = require("path");
const saveCache = () => fs.writeFileSync("./cache.json", JSON.stringify(cache, null, 2));
const {msg, prompt_, stop_} = require("./src/ScriptManager");

(async () => {
    await new Promise(r => app.on("ready", r));
    app.on("window-all-closed", () => process.exit());
    globalShortcut.register("CommandOrControl+Shift+Alt+C", () => {
        app.quit();
        process.exit();
    });
    globalShortcut.register("CommandOrControl+1", () => browser.webContents.toggleDevTools());
    ipcMain.handle("getCache", () => cache);
    ipcMain.handle("setCache", (event: any, o: any) => {
        cache = o;
        saveCache();
    });
    ipcMain.handle("getProcesses", () => Object.keys(scripts));
    ipcMain.handle("stopProcesses", () => stop_(""));
    ipcMain.handle("stopProcess", (_: any, n: any) => stop_(n));
    ipcMain.handle("getMessages", () => msg());
    ipcMain.on("sendPrompt", (_: any, p: any) => prompt_(p));

    const browser = new BrowserWindow({
        width: 800,
        height: 500,
        minWidth: 800,
        minHeight: 500,
        webPreferences: {preload: path.join(__dirname, "src", "preload.js")},
        autoHideMenuBar: true,
        icon: __dirname + "/src/icon.png",
        show: false
    });
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) app.quit();
    else app.on("second-instance", () => browser.focus());
    await browser.loadFile(path.join(__dirname, "src", "index.html"));
    browser.show();
    browser.setMenu(null);
})();