const {app, globalShortcut, BrowserWindow, ipcMain, shell} = require("electron");
const fs = require("fs");
if (!fs.existsSync("./cache.json")) fs.writeFileSync("./cache.json", JSON.stringify({
    scripts: {}
}))
let cache = require("./cache.json");
module.exports = {cache: () => cache};
const path = require("path");
const saveCache = () => fs.writeFileSync("./cache.json", JSON.stringify(cache, null, 2));
const {scripts, msg, prompt, stop} = require("./src/ScriptManager");

(async () => {
    await new Promise(r => app.on("ready", r));
    app.on("window-all-closed", () => process.exit());
    globalShortcut.register("CommandOrControl+1", () => browser.webContents.toggleDevTools());
    ipcMain.handle("minimize", () => browser.minimize());
    ipcMain.handle("getCache", () => cache);
    ipcMain.handle("setCache", (_, o) => {
        cache = o;
        saveCache();
    });
    ipcMain.handle("getProcesses", () => Object.keys(scripts));
    ipcMain.handle("stopProcesses", () => stop());
    ipcMain.handle("stopProcess", (_, n) => stop(n));
    ipcMain.handle("getMessages", () => msg());
    ipcMain.on("sendPrompt", (_, p) => prompt(p));

    const browser = new BrowserWindow({
        width: 800,
        height: 500,
        webPreferences: {preload: path.join(__dirname, "src", "preload.js")},
        autoHideMenuBar: true,
        frame: false,
        resizable: false
    });
    await browser.loadFile(path.join(__dirname, "src", "index.html"));
    browser.setMenu(null);
})();