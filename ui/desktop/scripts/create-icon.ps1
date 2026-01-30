# Create a minimal 256x256 PNG icon for electron-builder
# Uses .NET System.Drawing to create a simple icon

$ErrorActionPreference = "Stop"

$iconPath = Join-Path $PSScriptRoot "..\assets\icon.png"
$assetsDir = Split-Path $iconPath -Parent

if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
}

try {
    # Load System.Drawing assembly
    Add-Type -AssemblyName System.Drawing
    
    # Create a 256x256 bitmap
    $bitmap = New-Object System.Drawing.Bitmap(256, 256)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    
    # Set high quality rendering
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    
    # Fill with a dark background (you can customize colors)
    $graphics.Clear([System.Drawing.Color]::FromArgb(30, 30, 30))
    
    # Draw a simple "O" shape (for ORC)
    $font = New-Object System.Drawing.Font("Arial", 180, [System.Drawing.FontStyle]::Bold)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 200, 100))
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    
    $graphics.DrawString("O", $font, $brush, 128, 128, $format)
    
    # Save as PNG
    $bitmap.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    Write-Host "Created icon: $iconPath"
    
    # Cleanup
    $graphics.Dispose()
    $bitmap.Dispose()
    $font.Dispose()
    $brush.Dispose()
    
    # Now convert PNG to ICO if we have a tool, or electron-builder will handle it
    # For now, we'll also create an ICO version using the same approach
    $icoPath = Join-Path $assetsDir "icon.ico"
    
    # Create ICO with multiple sizes (16, 32, 48, 256)
    $sizes = @(16, 32, 48, 256)
    $images = New-Object System.Collections.ArrayList
    
    foreach ($size in $sizes) {
        $img = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($img)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.Clear([System.Drawing.Color]::FromArgb(30, 30, 30))
        
        $f = New-Object System.Drawing.Font("Arial", [int]($size * 0.7), [System.Drawing.FontStyle]::Bold)
        $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 200, 100))
        $fmt = New-Object System.Drawing.StringFormat
        $fmt.Alignment = [System.Drawing.StringAlignment]::Center
        $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
        
        $g.DrawString("O", $f, $b, $size/2, $size/2, $fmt)
        
        [void]$images.Add($img)
        
        $g.Dispose()
        $f.Dispose()
        $b.Dispose()
    }
    
    # Save as ICO (this is simplified - a full ICO writer would be more complex)
    # For now, we'll use the 256x256 image and let electron-builder handle multi-resolution
    $images[3].Save($icoPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    # Convert PNG to ICO format manually (ICO with PNG-compressed payload)
    $icoPath = Join-Path $assetsDir "icon.ico"
    
    # Load the 256x256 image
    $icoImage = $images[3] # 256x256 is at index 3
    
    # Encode as PNG in memory
    $ms = New-Object System.IO.MemoryStream
    $icoImage.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $ms.ToArray()
    $ms.Dispose()
    
    # Build ICO file format (single 256x256 image)
    $fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $bw = New-Object System.IO.BinaryWriter $fs
    
    # ICONDIR (6 bytes)
    $bw.Write([UInt16]0)  # reserved
    $bw.Write([UInt16]1)  # type = 1 (icon)
    $bw.Write([UInt16]1)  # image count = 1
    
    # ICONDIRENTRY (16 bytes)
    $bw.Write([byte]0)    # width  (0 => 256)
    $bw.Write([byte]0)    # height (0 => 256)
    $bw.Write([byte]0)    # color count
    $bw.Write([byte]0)    # reserved
    $bw.Write([UInt16]0)  # planes (unused for PNG)
    $bw.Write([UInt16]32) # bit count (hint)
    $bw.Write([UInt32]$pngBytes.Length) # bytes in resource
    $bw.Write([UInt32]22) # image offset (6 + 16)
    
    # PNG image data
    $bw.Write($pngBytes)
    
    $bw.Flush()
    $bw.Dispose()
    $fs.Dispose()
    
    Write-Host "Created ICO icon: $icoPath"
    
    # Cleanup all images
    foreach ($img in $images) {
        $img.Dispose()
    }
    
} catch {
    Write-Host "Error creating icon: $_"
    Write-Host "   Make sure you're running on Windows with .NET Framework available"
    exit 1
}
