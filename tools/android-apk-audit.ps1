param([Parameter(Mandatory=$true)][string]$Apk)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apkPath = (Resolve-Path -LiteralPath $Apk).Path
$repo = Split-Path -Parent $PSScriptRoot
$expectedPublic = (Get-FileHash -LiteralPath (Join-Path $repo 'apps/customer-android/app/src/main/assets/update-public.pem') -Algorithm SHA256).Hash
$archive = [System.IO.Compression.ZipFile]::OpenRead($apkPath)
$native = @()
$hasPublic = $false
$dexCount = 0
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -match '(\.(p12|jks|keystore)$|(^|/)(signing|keystore|local)\.properties$)') { throw "Unexpected signing/config file in APK: $($entry.FullName)" }
        if ($entry.FullName -notmatch '(^classes[0-9]*\.dex$|\.so$|^assets/update-public\.pem$)') { continue }
        $stream = $entry.Open()
        $memory = [System.IO.MemoryStream]::new()
        try { $stream.CopyTo($memory); $bytes = $memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
        if ($entry.FullName -eq 'assets/update-public.pem') {
            $digest = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes))
            if ($digest -ne $expectedPublic) { throw 'Pinned update public key mismatch' }
            $hasPublic = $true
        }
        if ($entry.FullName -match '^classes[0-9]*\.dex$') {
            $dexCount++
            $text = [System.Text.Encoding]::UTF8.GetString($bytes)
            if ($text.Contains('159.69.146.114') -or $text.Contains('rklydqhknkhcydoijmlq.supabase.co') -or $text.Contains('-----BEGIN PRIVATE KEY-----')) { throw 'Forbidden origin or private-key marker in DEX' }
        }
        if ($entry.FullName.EndsWith('.so')) {
            if ($bytes[0] -ne 0x7f -or $bytes[1] -ne 0x45 -or $bytes[2] -ne 0x4c -or $bytes[3] -ne 0x46 -or $bytes[5] -ne 1) { throw 'Invalid ELF format' }
            $is64 = $bytes[4] -eq 2
            if ($is64) {
                $offset = [BitConverter]::ToUInt64($bytes,32)
                $entrySize = [BitConverter]::ToUInt16($bytes,54)
                $count = [BitConverter]::ToUInt16($bytes,56)
            } else {
                $offset = [BitConverter]::ToUInt32($bytes,28)
                $entrySize = [BitConverter]::ToUInt16($bytes,42)
                $count = [BitConverter]::ToUInt16($bytes,44)
            }
            $alignments = @()
            for ($index=0; $index -lt $count; $index++) {
                $position = [int]($offset + $index * $entrySize)
                if ([BitConverter]::ToUInt32($bytes,$position) -ne 1) { continue }
                $alignment = if ($is64) { [BitConverter]::ToUInt64($bytes,$position+48) } else { [BitConverter]::ToUInt32($bytes,$position+28) }
                if ($alignment -lt 16384) { throw "Native library does not support 16KB ELF alignment: $($entry.FullName)" }
                $alignments += $alignment
            }
            if (!$alignments.Count) { throw 'ELF has no load segments' }
            $native += [pscustomobject]@{library=$entry.FullName; loadSegmentAlignments=$alignments}
        }
    }
} finally { $archive.Dispose() }
if (!$hasPublic -or !$dexCount) { throw 'Incomplete APK' }
[pscustomobject]@{
    apk=$apkPath
    sha256=(Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    pinnedPublicKeyVerified=$hasPublic
    exactForbiddenOriginAndPrivateKeyMarkersAbsent=$true
    dexFiles=$dexCount
    nativeLibraries=$native
    physicalDeviceInstallTested=$false
} | ConvertTo-Json -Depth 5
