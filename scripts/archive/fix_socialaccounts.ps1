$filePath = "src/components/analytics/SocialAccountsOverview.tsx"
$content = [System.IO.File]::ReadAllText($filePath)

$oldPattern = '      }})

      {/* Active account snapshot */}'

$newPattern = @'
))}

      {/* Active account title */}
      <div className="flex items-center gap-3 pt-2">
        <PlatformLogo platform={activeAccount.platform} size={32} />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Connected Account</div>
          <h2 className="text-2xl font-black tracking-tight text-slate-950">{activeAccount.account_name || activeAccount.handle || 'Unnamed Account'}</h2>
        </div>
      </div>

      {/* Active account snapshot */}
'@

$newContent = $content.Replace($oldPattern, $newPattern)
[System.IO.File]::WriteAllText($filePath, $newContent, [System.Text.Encoding]::UTF8)
Write-Host "File updated with proper UTF-8 encoding"
