param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$DestinationPath
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [System.IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\')
$sourcePrefix = $sourceRoot + '\'
$destination = [System.IO.Path]::GetFullPath($DestinationPath)

if (-not [System.IO.Directory]::Exists($sourceRoot)) {
  throw 'package source directory does not exist'
}
if ([System.IO.File]::Exists($destination) -or [System.IO.Directory]::Exists($destination)) {
  throw 'package ZIP destination already exists'
}

Add-Type -AssemblyName System.IO.Compression
$createdDestination = $false
$completed = $false
$outputStream = $null
$archive = $null
try {
  $outputStream = [System.IO.File]::Open(
    $destination,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
  $createdDestination = $true
  $archive = [System.IO.Compression.ZipArchive]::new(
    $outputStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )

  $files = [System.IO.Directory]::GetFiles(
    $sourceRoot,
    '*',
    [System.IO.SearchOption]::AllDirectories
  ) | Sort-Object
  if ($files.Count -eq 0) {
    throw 'package source directory is empty'
  }

  foreach ($filePath in $files) {
    $fullPath = [System.IO.Path]::GetFullPath($filePath)
    if (-not $fullPath.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'package file escaped its source directory'
    }
    $entryName = $fullPath.Substring($sourcePrefix.Length).Replace('\', '/')
    $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $inputStream = [System.IO.File]::OpenRead($fullPath)
    $entryStream = $null
    try {
      $entryStream = $entry.Open()
      $inputStream.CopyTo($entryStream)
    } finally {
      if ($null -ne $entryStream) { $entryStream.Dispose() }
      $inputStream.Dispose()
    }
  }
  $archive.Dispose()
  $archive = $null
  $outputStream = $null
  $completed = $true
} finally {
  if ($null -ne $archive) { $archive.Dispose() }
  elseif ($null -ne $outputStream) { $outputStream.Dispose() }
  if (-not $completed -and $createdDestination -and [System.IO.File]::Exists($destination)) {
    [System.IO.File]::Delete($destination)
  }
}
