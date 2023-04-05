const {ipcRenderer, contextBridge} = require("electron");

window.neet = {};
contextBridge.exposeInMainWorld("neet", {
    minimize: () => ipcRenderer.invoke("minimize"),
    getCache: () => ipcRenderer.invoke("getCache"),
    setCache: o => ipcRenderer.invoke("setCache", o),
    sendPrompt: p => ipcRenderer.send("sendPrompt", p),
    stopProcesses: () => ipcRenderer.invoke("stopProcesses"),
    stopProcess: v => ipcRenderer.invoke("stopProcess", v),
    getMessages: () => ipcRenderer.invoke("getMessages")
});