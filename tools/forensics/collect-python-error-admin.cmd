@echo off
setlocal EnableExtensions

set "OUT=C:\Users\o-neo\Documents\Vip-Gece-Web-Gelistirme\docs\forensics\python-error-20260914"
if not exist "%OUT%" mkdir "%OUT%"

del /q "%OUT%\collection-complete.txt" 2>nul

(
  echo Python error elevated evidence collection
  echo Collection started: %DATE% %TIME%
  echo.
  whoami
  whoami /groups
  echo.
  echo ==== Privilege check ====
  fltmc
  echo.
  echo ==== Process Creation audit policy ====
  auditpol /get /subcategory:{0CCE922B-69AE-11D9-BED3-505054503030}
  echo.
  echo ==== Relevant event-log metadata ====
  wevtutil gli Security
  wevtutil gli Microsoft-Windows-Sysmon/Operational
  wevtutil gli Microsoft-Windows-WER-Diag/Operational
  echo.
  echo ==== Python resolution ====
  where python.exe
  where py.exe
  echo.
  echo ==== Current Python process ====
  tasklist /FI "IMAGENAME eq python.exe" /V
  wmic process where "name='python.exe'" get ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate /format:list
  echo.
  echo ==== Current TCP/UDP table ====
  netstat -ano
  echo.
  echo ==== Python runtime file inventory ====
  dir /a "C:\Tools\Python313"
  type "C:\Tools\Python313\python313._pth"
  dir /a /b "C:\Tools\Python313\Scripts"
  dir /a /b "C:\Tools\Python313\Lib\site-packages"
  echo.
  echo ==== Runtime hashes ====
  certutil -hashfile "C:\Tools\Python313\python.exe" SHA256
  certutil -hashfile "C:\Tools\Python313\python313.dll" SHA256
  certutil -hashfile "C:\Tools\Python313\pythonw.exe" SHA256
  echo.
  echo ==== PE dependency tool availability ====
  where dumpbin.exe
  where llvm-objdump.exe
  echo.
  echo ==== Scheduled task and service snapshots ====
  schtasks /query /fo LIST /v
  sc queryex type= service state= all
  echo.
  echo ==== Startup registry values ====
  reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\Run"
  reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
  echo.
  echo Collection summary finished: %DATE% %TIME%
) > "%OUT%\admin-summary.txt" 2>&1

wevtutil qe System /q:"*[System[(EventID=26) and TimeCreated[@SystemTime >= '2026-09-13T21:15:00.000Z' and @SystemTime <= '2026-09-13T21:45:00.000Z']]]" /f:xml /rd:true > "%OUT%\system-event-26.xml" 2> "%OUT%\system-event-26.err.txt"
wevtutil qe Application /q:"*[System[((EventID=1000 or EventID=1001 or EventID=1002 or EventID=1026)) and TimeCreated[@SystemTime >= '2026-09-13T21:15:00.000Z' and @SystemTime <= '2026-09-13T21:45:00.000Z']]]" /f:xml /rd:true > "%OUT%\application-fault-events.xml" 2> "%OUT%\application-fault-events.err.txt"
wevtutil qe Security /q:"*[System[((EventID=4688 or EventID=5156 or EventID=5157)) and TimeCreated[@SystemTime >= '2026-09-13T21:15:00.000Z' and @SystemTime <= '2026-09-13T21:45:00.000Z']]]" /f:xml /rd:false > "%OUT%\security-process-network-events.xml" 2> "%OUT%\security-process-network-events.err.txt"
wevtutil qe Microsoft-Windows-Sysmon/Operational /q:"*[System[((EventID=1 or EventID=3 or EventID=7 or EventID=11 or EventID=22)) and TimeCreated[@SystemTime >= '2026-09-13T21:15:00.000Z' and @SystemTime <= '2026-09-13T21:45:00.000Z']]]" /f:xml /rd:false > "%OUT%\sysmon-events.xml" 2> "%OUT%\sysmon-events.err.txt"
wevtutil qe Microsoft-Windows-WER-Diag/Operational /q:"*[System[TimeCreated[@SystemTime >= '2026-09-13T21:15:00.000Z' and @SystemTime <= '2026-09-13T21:45:00.000Z']]]" /f:xml /rd:false > "%OUT%\wer-operational-events.xml" 2> "%OUT%\wer-operational-events.err.txt"

dir /s /a /t:w "C:\ProgramData\Microsoft\Windows\WER\ReportArchive" > "%OUT%\wer-reportarchive-list.txt" 2>&1
dir /s /a /t:w "C:\ProgramData\Microsoft\Windows\WER\ReportQueue" > "%OUT%\wer-reportqueue-list.txt" 2>&1
dir /a /t:w "C:\Windows\Prefetch\PYTHON*.pf" > "%OUT%\python-prefetch-list.txt" 2>&1
fltmc volumes > "%OUT%\volume-device-map.txt" 2>&1

(
  for /r "C:\ProgramData\Microsoft\Windows\WER\ReportArchive" %%F in (Report.wer) do @findstr /i /c:"python.exe" "%%F" >nul 2>nul && @echo ==== %%F ==== && @type "%%F"
  for /r "C:\ProgramData\Microsoft\Windows\WER\ReportQueue" %%F in (Report.wer) do @findstr /i /c:"python.exe" "%%F" >nul 2>nul && @echo ==== %%F ==== && @type "%%F"
) > "%OUT%\python-wer-reports.txt" 2>&1

(
  echo Collection completed: %DATE% %TIME%
  echo Output: %OUT%
) > "%OUT%\collection-complete.txt"

endlocal
