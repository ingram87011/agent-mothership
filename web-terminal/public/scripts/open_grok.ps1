$url = "https://calvin-helen-facilities-flour.trycloudflare.com/grok_prompt4.txt"
$content = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
$desktop = [Environment]::GetFolderPath("Desktop")
$path = "$desktop\grok_prompt4.txt"
Set-Content -Path $path -Value $content -Encoding UTF8
Write-Host "Wrote grok_prompt4.txt to Desktop ($($content.Length) bytes)"
Start-Process notepad -ArgumentList $path
Write-Host "Opened Notepad"
