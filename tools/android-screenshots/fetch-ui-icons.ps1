$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../apps/customer-android'))
$commit = (Invoke-RestMethod 'https://api.github.com/repos/google/material-design-icons/commits/master').sha
$base = "https://raw.githubusercontent.com/google/material-design-icons/$commit"
$icons = @{
    arrow_back='navigation'; logout='action'; refresh='navigation'; save='content';
    add_photo_alternate='image'; add='content'; person_outline='social'; photo_library='image';
    lock='action'; visibility='action'; visibility_off='action'; close='navigation'; chevron_right='navigation'
}
$proof = @()
foreach ($name in $icons.Keys) {
    $url = "$base/android/$($icons[$name])/$name/materialiconsoutlined/black/res/drawable/outline_${name}_24.xml"
    $bytes = (Invoke-WebRequest -UseBasicParsing $url).Content
    if ($bytes -is [byte[]]) { $bytes = [Text.Encoding]::UTF8.GetString($bytes) }
    if ($bytes.Length -gt 30000 -or $bytes -match '<!DOCTYPE|<!ENTITY') { throw 'Unexpected icon content' }
    $xml = [xml]$bytes
    if ($xml.DocumentElement.Name -ne 'vector') { throw 'Expected a vector resource' }
    $xml.DocumentElement.SetAttribute('tint','http://schemas.android.com/apk/res/android','?android:attr/colorControlNormal') | Out-Null
    $bytes = $xml.OuterXml
    $file = Join-Path $root "app/src/main/res/drawable/ic_${name}.xml"
    [IO.File]::WriteAllText($file, $bytes, [Text.UTF8Encoding]::new($false))
    $proof += @{file="ic_${name}.xml";url=$url;sha256=(Get-FileHash $file -Algorithm SHA256).Hash}
}
$notice = Join-Path $root 'third-party'
New-Item -ItemType Directory -Force -Path $notice | Out-Null
Invoke-WebRequest -UseBasicParsing "$base/LICENSE" -OutFile (Join-Path $notice 'material-icons-LICENSE.txt')
[IO.File]::WriteAllText((Join-Path $notice 'material-icons.json'), (@{commit=$commit;icons=$proof} | ConvertTo-Json -Depth 5))
Write-Output "Imported $($proof.Count) official Material vector icons; pinned source $commit"
