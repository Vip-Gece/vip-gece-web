Option Explicit

Dim shell, commandPath
commandPath = "C:\Users\o-neo\Documents\Vip-Gece-Web-Gelistirme\tools\forensics\collect-deep-python-btk-admin.cmd"
Set shell = CreateObject("Shell.Application")
shell.ShellExecute "cmd.exe", "/c """ & commandPath & """", "", "runas", 1
