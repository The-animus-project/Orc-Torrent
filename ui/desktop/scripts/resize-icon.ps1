# Resize icon to 256x256 for electron-builder (requires at least 256x256)
# Uses .NET System.Drawing to resize an existing ICO file
# Usage: .\resize-icon.ps1 [-Source path] - defaults: orc_ico(1).ico, then icon.ico

param(
    [string]$Source = ""
)

$ErrorActionPreference = "Stop"

$assetsDir = Join-Path $PSScriptRoot "..\assets"
$iconsDir = Join-Path $assetsDir "icons"
$outputIconPath = Join-Path $iconsDir "icon.ico"

# Resolve source: explicit param > orc_ico(1).ico > icon.ico
if ($Source -and (Test-Path $Source)) {
    $sourceIconPath = $Source
} elseif ($Source) {
    # Resolve relative to assets dir
    $candidate = Join-Path $assetsDir $Source
    if (Test-Path $candidate) { $sourceIconPath = $candidate } else { $sourceIconPath = $Source }
} else {
    $orcIco = Join-Path $iconsDir "orc_ico(1).ico"
    if (Test-Path $orcIco) {
        $sourceIconPath = $orcIco
    } elseif (Test-Path $outputIconPath) {
        $sourceIconPath = $outputIconPath  # Resize icon.ico in place
    } else {
        Write-Host "ERROR: No source icon found. Place orc_ico(1).ico or icon.ico in assets/icons/"
        exit 1
    }
}

if (-not (Test-Path $sourceIconPath)) {
    Write-Host "ERROR: Source icon not found: $sourceIconPath"
    exit 1
}

if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
}
if (-not (Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null
}

try {
    # Load System.Drawing assembly
    Add-Type -AssemblyName System.Drawing
    
    # Load the source icon
    Write-Host "Loading source icon: $sourceIconPath"
    $sourceIcon = New-Object System.Drawing.Icon($sourceIconPath)
    
    # Get the largest size from the source icon, or use the default size
    $sourceSize = $sourceIcon.Size
    Write-Host "Source icon size: $($sourceSize.Width)x$($sourceSize.Height)"
    
    # Create a bitmap from the source icon
    $sourceBitmap = $sourceIcon.ToBitmap()
    
    # Create ICO with multiple sizes (16, 32, 48, 256)
    $sizes = @(16, 32, 48, 256)
    $images = New-Object System.Collections.ArrayList
    
    Write-Host "Resizing to multiple resolutions..."
    
    foreach ($size in $sizes) {
        # Create a new bitmap at the target size
        $resized = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($resized)
        
        # Set high quality rendering
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        
        # Draw the source image resized to the target size
        $g.DrawImage($sourceBitmap, 0, 0, $size, $size)
        
        [void]$images.Add($resized)
        $g.Dispose()
        
        Write-Host "  Created ${size}x${size} image"
    }
    
    # Cleanup source resources
    $sourceBitmap.Dispose()
    $sourceIcon.Dispose()
    
    # Build ICO file with multiple resolutions
    Write-Host "Creating ICO file with multiple resolutions..."
    
    $fs = [System.IO.File]::Open($outputIconPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $bw = New-Object System.IO.BinaryWriter $fs
    
    # ICONDIR (6 bytes)
    $bw.Write([UInt16]0)  # reserved
    $bw.Write([UInt16]1)  # type = 1 (icon)
    $bw.Write([UInt16]$sizes.Length)  # image count
    
    # Calculate offset for image data (starts after ICONDIR + all ICONDIRENTRY structures)
    $headerSize = 6 + (16 * $sizes.Length)
    $currentOffset = $headerSize
    
    # Store PNG data for each size
    $pngDataList = New-Object System.Collections.ArrayList
    
    # Write ICONDIRENTRY for each size
    for ($i = 0; $i -lt $sizes.Length; $i++) {
        $size = $sizes[$i]
        $img = $images[$i]
        
        # Encode as PNG in memory
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBytes = $ms.ToArray()
        $ms.Dispose()
        
        [void]$pngDataList.Add($pngBytes)
        
        # ICONDIRENTRY (16 bytes)
        $width = if ($size -eq 256) { [byte]0 } else { [byte]$size }
        $height = if ($size -eq 256) { [byte]0 } else { [byte]$size }
        
        $bw.Write($width)   # width  (0 => 256)
        $bw.Write($height)  # height (0 => 256)
        $bw.Write([byte]0)  # color count
        $bw.Write([byte]0)  # reserved
        $bw.Write([UInt16]0)  # planes (unused for PNG)
        $bw.Write([UInt16]32) # bit count (hint)
        $bw.Write([UInt32]$pngBytes.Length) # bytes in resource
        $bw.Write([UInt32]$currentOffset) # image offset
        
        $currentOffset += $pngBytes.Length
    }
    
    # Write PNG image data for each size
    foreach ($pngBytes in $pngDataList) {
        $bw.Write($pngBytes)
    }
    
    $bw.Flush()
    $bw.Dispose()
    $fs.Dispose()
    
    Write-Host "SUCCESS: Created ICO icon: $outputIconPath"
    Write-Host "  Sizes included: $($sizes -join ', ')x"
    
    # Cleanup all images
    foreach ($img in $images) {
        $img.Dispose()
    }
    
    # Verify the output file
    if (Test-Path $outputIconPath) {
        $fileInfo = Get-Item $outputIconPath
        Write-Host "  File size: $([math]::Round($fileInfo.Length / 1KB, 2)) KB"
    }
    
} catch {
    Write-Host "ERROR: Error resizing icon: $_"
    Write-Host "  Stack trace: $($_.ScriptStackTrace)"
    Write-Host "  Make sure you're running on Windows with .NET Framework available"
    exit 1
}
