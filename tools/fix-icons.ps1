param(
  [string]$SrcPath = 'C:\Projects\mechvibesfusion.png',
  [string]$OutDir = 'C:\Projects\mechvibes-fusion\assets'
)
# Regenerate app/tray icons from the source logo: crop any transparent margins,
# scale the art to fill ~92% of the canvas, and write a multi-size .ico.
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

function Get-OpaqueBounds([System.Drawing.Bitmap]$bmp, [int]$threshold = 16) {
  $minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1; $vis = 0
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      if ($bmp.GetPixel($x, $y).A -gt $threshold) {
        $vis++
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  return [pscustomobject]@{ minX = $minX; minY = $minY; maxX = $maxX; maxY = $maxY; visible = $vis }
}

function Draw-Icon([System.Drawing.Image]$source, [System.Drawing.Rectangle]$srcRect, [int]$size) {
  $bmp = New-Object -TypeName System.Drawing.Bitmap -ArgumentList $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  # destRect = whole canvas, srcRect = cropped source region (fills the icon)
  $destRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $g.DrawImage($source, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $bmp
}

# --- work at source resolution so cropping is pixel-accurate ---
$src = New-Object -TypeName System.Drawing.Bitmap -ArgumentList $SrcPath
$b = Get-OpaqueBounds $src
Write-Output ("source opaque bounds: {0},{1}..{2},{3} (visible={4})" -f $b.minX, $b.minY, $b.maxX, $b.maxY, $b.visible)
if ($b.maxX -lt 0) { Write-Error 'No opaque pixels found' }

$bw = $b.maxX - $b.minX
$bh = $b.maxY - $b.minY
$pad = [int](0.03 * [Math]::Max($bw, $bh))
$cropX = [Math]::Max(0, $b.minX - $pad)
$cropY = [Math]::Max(0, $b.minY - $pad)
$cropW = [Math]::Min($src.Width - $cropX, $bw + 2 * $pad)
$cropH = [Math]::Min($src.Height - $cropY, $bh + 2 * $pad)
$cropRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropW, $cropH)
Write-Output ("crop (source px): {0} {1} {2}x{3}" -f $cropX, $cropY, $cropW, $cropH)

# icon.png (256) and tray-icon.png (32)
$icon256 = Draw-Icon $src $cropRect 256
$icon256.Save((Join-Path $OutDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon256.Dispose()
Write-Output 'wrote icon.png (256)'

$tray32 = Draw-Icon $src $cropRect 32
$tray32.Save((Join-Path $OutDir 'tray-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$tray32.Dispose()
Write-Output 'wrote tray-icon.png (32)'

# multi-size .ico (16,24,32,48,64,128,256)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = @()
foreach ($s in $sizes) { $frames += Draw-Icon $src $cropRect $s }
$ms = New-Object System.IO.MemoryStream
$iconW = $frames[0].Width
$iconH = $frames[0].Height
# ICO header
$bw = [System.IO.BinaryWriter]::new($ms)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
  [byte]$w = if ($f.Width -ge 256) { 0 } else { $f.Width }
  [byte]$h = if ($f.Height -ge 256) { 0 } else { $f.Height }
  $bw.Write($w); $bw.Write($h)
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $fmem = New-Object System.IO.MemoryStream
  $f.Save($fmem, [System.Drawing.Imaging.ImageFormat]::Png)
  $data = $fmem.ToArray(); $fmem.Dispose()
  $bw.Write([UInt32]$data.Length); $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($f in $frames) {
  $fmem = New-Object System.IO.MemoryStream
  $f.Save($fmem, [System.Drawing.Imaging.ImageFormat]::Png)
  $data = $fmem.ToArray(); $fmem.Dispose()
  $bw.Write($data)
}
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'icon.ico'), $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
foreach ($f in $frames) { $f.Dispose() }
Write-Output 'wrote icon.ico (multi-size)'
$src.Dispose()
