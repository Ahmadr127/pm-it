' Menjalankan aplikasi PM-IT di latar belakang tanpa jendela (dipakai oleh auto-start Windows).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(dir)
sh.Run "cmd /c """ & dir & "\server-latar.bat""", 0, False
