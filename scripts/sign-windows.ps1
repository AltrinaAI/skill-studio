<#
.SYNOPSIS
    Signs a Windows binary with Azure Trusted Signing via jsign — best-effort.

.DESCRIPTION
    Invoked by Tauri's `bundle.windows.signCommand`. Tauri passes the path of each
    binary/installer to sign as the first argument (the "%1" placeholder).

    Signing is BEST-EFFORT by design: if signing is not configured, or the signing
    credentials / certificate are not yet usable, the script logs a warning and exits 0
    so the build still produces an (unsigned) artifact instead of failing. This is what
    you want before a real code-signing certificate is provisioned.

    Set AZURE_SIGNING_REQUIRED=1 once a working certificate is in place to make signing
    mandatory — then any signing failure aborts the build (so you never ship an unsigned
    artifact believing it was signed).

.REQUIRED ENVIRONMENT (to actually sign)
    AZURE_SIGNING_ENDPOINT  e.g. https://wus2.codesigning.azure.net
    AZURE_SIGNING_ALIAS     "<account-name>/<certificate-profile-name>"
    (an authenticated `az` session is required to mint the signing token)

.OPTIONAL ENVIRONMENT
    AZURE_SIGNING_REQUIRED  "1"/"true" => signing failures abort the build
                            (default: best-effort — warn and build unsigned)
    JSIGN_JAR               path to jsign.jar; if unset, the `jsign` launcher on PATH is used
    AZURE_TIMESTAMP_URL     timestamp authority (defaults to Microsoft's RFC3161 TSA)
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"

# Whether a signing failure should abort the build. Default: best-effort (warn, build unsigned).
$requireFlag = $env:AZURE_SIGNING_REQUIRED
$required = (-not [string]::IsNullOrWhiteSpace($requireFlag)) -and ($requireFlag -notin @('0', 'false', 'no'))

# Either abort (when signing is required) or skip gracefully and build unsigned.
# Write-Host goes to stdout, which Tauri echoes as "Output of signing command", so the
# reason is visible in normal CI logs (not just --verbose).
function Complete-WithoutSigning([string]$reason) {
    if ($required) {
        throw "AZURE_SIGNING_REQUIRED is set but signing could not be performed: $reason"
    }
    Write-Host "WARNING: building '$FilePath' UNSIGNED — $reason"
    exit 0
}

$endpoint = $env:AZURE_SIGNING_ENDPOINT
$alias    = $env:AZURE_SIGNING_ALIAS

if ([string]::IsNullOrWhiteSpace($endpoint) -or [string]::IsNullOrWhiteSpace($alias)) {
    Complete-WithoutSigning "Azure signing not configured (AZURE_SIGNING_ENDPOINT / AZURE_SIGNING_ALIAS missing)."
}

try {
    $tsaUrl = if ([string]::IsNullOrWhiteSpace($env:AZURE_TIMESTAMP_URL)) {
        "http://timestamp.acs.microsoft.com/"
    } else {
        $env:AZURE_TIMESTAMP_URL
    }

    # Mint a short-lived access token for the code signing service from the current az session.
    $token = az account get-access-token --resource "https://codesigning.azure.net" --query accessToken -o tsv
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "failed to obtain an Azure access token for code signing (is 'az login' done?)."
    }

    # Prefer an explicit jar (CI downloads one); otherwise rely on the jsign launcher on PATH.
    if (-not [string]::IsNullOrWhiteSpace($env:JSIGN_JAR)) {
        $exe = "java"
        $pre = @("-jar", $env:JSIGN_JAR)
    } else {
        $exe = "jsign"
        $pre = @()
    }

    $jsignArgs = @(
        "--storetype", "TRUSTEDSIGNING",
        "--keystore",  $endpoint,
        "--storepass", $token,
        "--alias",     $alias,
        "--tsaurl",    $tsaUrl,
        "--tsmode",    "RFC3161",
        $FilePath
    )

    Write-Host "Signing '$FilePath' with Azure Trusted Signing (alias: $alias)"
    & $exe @($pre + $jsignArgs)
    if ($LASTEXITCODE -ne 0) {
        throw "jsign failed with exit code $LASTEXITCODE."
    }
    Write-Host "Signed '$FilePath'"
}
catch {
    Complete-WithoutSigning "signing failed: $($_.Exception.Message)"
}
