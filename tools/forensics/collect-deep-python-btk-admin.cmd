@echo off
setlocal EnableExtensions

set "OUT=C:\Users\o-neo\Documents\Vip-Gece-Web-Gelistirme\docs\forensics\python-btk-deep-20260914"
if not exist "%OUT%" mkdir "%OUT%"
del /q "%OUT%\collection-complete.txt" 2>nul

(
  echo Deep Python-BTK forensic collection
  echo Started: %DATE% %TIME%
  echo.
  whoami
  whoami /all
  echo.
  echo ==== Event log inventory ====
  wevtutil el
  echo.
  echo ==== WER configuration ====
  reg query "HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting" /s
  reg query "HKCU\SOFTWARE\Microsoft\Windows\Windows Error Reporting" /s
  reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AeDebug" /s
  reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows NT\CurrentVersion\AeDebug" /s
  echo.
  echo ==== Prefetch configuration ====
  reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters" /s
  echo.
  echo ==== Sysmon service and configuration ====
  sc qc Sysmon64
  sc queryex Sysmon64
  reg query "HKLM\SYSTEM\CurrentControlSet\Services\Sysmon64" /s
  where Sysmon64.exe
  if exist "C:\Windows\Sysmon64.exe" "C:\Windows\Sysmon64.exe" -c
  if exist "C:\Windows\Sysmon.exe" "C:\Windows\Sysmon.exe" -c
  echo.
  echo ==== Audit policy ====
  auditpol /get /category:*
  echo.
  echo ==== Crash/WER/Prefetch/Amcache inventories ====
  dir /s /a /t:w "C:\Users\o-neo\AppData\Local\CrashDumps"
  dir /s /a /t:w "C:\Windows\Minidump"
  dir /s /a /t:w "C:\Windows\LiveKernelReports"
  dir /s /a /t:w "C:\ProgramData\Microsoft\Windows\WER"
  dir /s /a /t:w "C:\Windows\Prefetch"
  dir /a /t:w "C:\Windows\AppCompat\Programs\Amcache.hve"
  certutil -hashfile "C:\Windows\AppCompat\Programs\Amcache.hve" SHA256
  echo.
  echo ==== Target runtime metadata/hashes ====
  dir /a /r /t:c "C:\Users\o-neo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  dir /a /r /t:w "C:\Users\o-neo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  certutil -hashfile "C:\Users\o-neo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" SHA256
  certutil -hashfile "C:\Users\o-neo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python312.dll" SHA256
  certutil -hashfile "C:\Users\o-neo\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" SHA256
  certutil -hashfile "C:\Users\o-neo\.codex\.sandbox-bin\codex-command-runner-0.154.0-alpha.6.2.exe" SHA256
  echo.
  echo ==== BTK/KBN file identities ====
  dir /a /r /t:c "C:\Users\o-neo\AppData\Local\Temp\btk-kbn.xls"
  dir /a /r /t:w "C:\Users\o-neo\AppData\Local\Temp\btk-kbn.xls"
  fsutil file queryfileid "C:\Users\o-neo\AppData\Local\Temp\btk-kbn.xls"
  fsutil usn readdata "C:\Users\o-neo\AppData\Local\Temp\btk-kbn.xls"
  certutil -hashfile "C:\Users\o-neo\AppData\Local\Temp\btk-kbn.xls" SHA256
  dir /a /r /t:c "C:\Users\o-neo\AppData\Local\Temp\KBN.xls"
  dir /a /r /t:w "C:\Users\o-neo\AppData\Local\Temp\KBN.xls"
  fsutil file queryfileid "C:\Users\o-neo\AppData\Local\Temp\KBN.xls"
  fsutil usn readdata "C:\Users\o-neo\AppData\Local\Temp\KBN.xls"
  certutil -hashfile "C:\Users\o-neo\AppData\Local\Temp\KBN.xls" SHA256
  echo Finished summary: %DATE% %TIME%
) > "%OUT%\admin-deep-summary.txt" 2>&1

wevtutil qe Microsoft-Windows-Sysmon/Operational /q:"*[System[TimeCreated[@SystemTime >= '2026-09-13T21:00:00.000Z' and @SystemTime <= '2026-09-13T22:15:00.000Z']]]" /f:xml /rd:false > "%OUT%\sysmon-all-events.xml" 2> "%OUT%\sysmon-all-events.err.txt"
wevtutil qe Security /q:"*[System[((EventID=4688 or EventID=4689 or EventID=5156 or EventID=5157 or EventID=4656 or EventID=4658 or EventID=4663 or EventID=4697 or EventID=4698 or EventID=4719 or EventID=1102)) and TimeCreated[@SystemTime >= '2026-09-13T21:00:00.000Z' and @SystemTime <= '2026-09-13T22:15:00.000Z']]]" /f:xml /rd:false > "%OUT%\security-target-events.xml" 2> "%OUT%\security-target-events.err.txt"
wevtutil qe System /q:"*[System[((EventID=26 or EventID=6 or EventID=225 or EventID=7036 or EventID=7045)) and TimeCreated[@SystemTime >= '2026-09-13T21:00:00.000Z' and @SystemTime <= '2026-09-13T22:15:00.000Z']]]" /f:xml /rd:false > "%OUT%\system-target-events.xml" 2> "%OUT%\system-target-events.err.txt"
wevtutil qe Application /q:"*[System[((EventID=1000 or EventID=1001 or EventID=1002 or EventID=1023 or EventID=1026 or EventID=33)) and TimeCreated[@SystemTime >= '2026-09-13T21:00:00.000Z' and @SystemTime <= '2026-09-13T22:15:00.000Z']]]" /f:xml /rd:false > "%OUT%\application-target-events.xml" 2> "%OUT%\application-target-events.err.txt"
wevtutil qe Microsoft-Windows-WER-Diag/Operational /q:"*[System[TimeCreated[@SystemTime >= '2026-09-13T21:00:00.000Z' and @SystemTime <= '2026-09-13T22:15:00.000Z']]]" /f:xml /rd:false > "%OUT%\wer-diag-events.xml" 2> "%OUT%\wer-diag-events.err.txt"
wevtutil qe Microsoft-Windows-PowerShell/Operational /q:"*[System[((EventID=4103 or EventID=4104 or EventID=53504)) and TimeCreated[@SystemTime >= '2026-09-13T21:00:00.000Z' and @SystemTime <= '2026-09-13T22:15:00.000Z']]]" /f:xml /rd:false > "%OUT%\powershell-events.xml" 2> "%OUT%\powershell-events.err.txt"
wevtutil qe Microsoft-Windows-DNS-Client/Operational /q:"*[System[TimeCreated[@SystemTime >= '2026-09-13T21:00:00.000Z' and @SystemTime <= '2026-09-13T22:15:00.000Z']]]" /f:xml /rd:false > "%OUT%\dns-client-events.xml" 2> "%OUT%\dns-client-events.err.txt"
wevtutil qe Microsoft-Windows-CodeIntegrity/Operational /q:"*[System[TimeCreated[@SystemTime >= '2026-09-13T21:00:00.000Z' and @SystemTime <= '2026-09-13T22:15:00.000Z']]]" /f:xml /rd:false > "%OUT%\codeintegrity-events.xml" 2> "%OUT%\codeintegrity-events.err.txt"

dir /s /a /b "C:\*btk*" > "%OUT%\c-drive-name-btk.txt" 2>&1
dir /s /a /b "C:\*kbn*" > "%OUT%\c-drive-name-kbn.txt" 2>&1
dir /s /a /b "C:\*pythonhosted*" > "%OUT%\c-drive-name-pythonhosted.txt" 2>&1
dir /s /a /b "C:\*pypi*" > "%OUT%\c-drive-name-pypi.txt" 2>&1

(
  echo Completed: %DATE% %TIME%
  echo Output: %OUT%
) > "%OUT%\collection-complete.txt"

endlocal
