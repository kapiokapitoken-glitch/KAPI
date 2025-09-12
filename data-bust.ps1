Add-Type -AssemblyName System.Text.RegularExpressions

# 1) data.json'ı tek parça olarak oku
$s = Get-Content -Raw .\data.json

# 2) Zaman damgası
$v = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

# 3) Görseller
$imgExts = 'png','jpg','jpeg','webp','gif'
foreach ($ext in $imgExts) {
  $re = '"images/([^"?]+?)\.' + [Regex]::Escape($ext) + '(?:\?[^"]*)?"'
  $s  = [Regex]::Replace($s, $re, { param($m) '"images/' + $m.Groups[1].Value + '.' + $ext + '?v=' + $using:v + '"' })
}

# 4) Ses/diğer medya
$audExts = 'mp3','wav','ogg'
foreach ($ext in $audExts) {
  $re = '"media/([^"?]+?)\.' + [Regex]::Escape($ext) + '(?:\?[^"]*)?"'
  $s  = [Regex]::Replace($s, $re, { param($m) '"media/' + $m.Groups[1].Value + '.' + $ext + '?v=' + $using:v + '"' })
}

# 5) Dosyayı geri yaz
Set-Content -Path .\data.json -Value $s -Encoding UTF8

Write-Host "OK: cache-bust applied with v=$v"
