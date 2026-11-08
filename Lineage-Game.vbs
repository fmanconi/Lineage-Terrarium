' Windowless desktop launcher for Lineage (Standalone Fast-Life Software Mode)
Option Explicit
Dim fso, rootDir, pyw, py, cmd, shell
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
pyw = rootDir & "\.venv\Scripts\pythonw.exe"
py = rootDir & "\.venv\Scripts\python.exe"

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = rootDir

If fso.FileExists(pyw) Then
    cmd = """" & pyw & """ -m lineage_server.desktop"
    shell.Run cmd, 0, False
ElseIf fso.FileExists(py) Then
    cmd = """" & py & """ -m lineage_server.desktop"
    shell.Run cmd, 0, False
Else
    MsgBox "Ambiente Python (.venv) non trovato in: " & rootDir, vbCritical, "Lineage"
End If
