Set WshShell = CreateObject("WScript.Shell")
curDir = WshShell.CurrentDirectory
WshShell.Run "cmd.exe /C cd " & curDir & " && ""./start.cmd""", 0
Set WshShell = Nothing