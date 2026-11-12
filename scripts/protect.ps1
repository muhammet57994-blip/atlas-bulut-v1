param([ValidateSet('Protect','Unprotect')] [string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd()
if ($Action -eq 'Protect') {
  $bytes = [Text.Encoding]::UTF8.GetBytes($inputText)
  $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($protected))
} else {
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputText), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
}
