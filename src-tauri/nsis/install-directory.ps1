$ErrorActionPreference = 'Stop'

try {
    # 路径只作为数据读取；不拼接命令、不访问 bootstrap 的外置数据根。
    $moonInstallTarget = $env:MOON_INSTALL_DIRECTORY
    if ([string]::IsNullOrWhiteSpace($moonInstallTarget)) { exit 2 }
    if ($moonInstallTarget -notmatch '^[A-Za-z]:\\') { exit 2 }
    $moonInstallTarget = [IO.Path]::GetFullPath($moonInstallTarget).TrimEnd('\')
    if ($moonInstallTarget.Length -le 2) { exit 2 }
    $moonResourceLength = 0
    $null = [int]::TryParse($env:MOON_MAX_RESOURCE_PATH, [ref]$moonResourceLength)
    if ($moonResourceLength -lt 0 -or $moonInstallTarget.Length + 1 + $moonResourceLength -ge 260) { exit 8 }

    $moonUserDirectories = @(
        [Environment]::GetFolderPath('UserProfile'),
        [Environment]::GetFolderPath('ApplicationData'),
        [Environment]::GetFolderPath('LocalApplicationData')
    )
    # 同时拒绝其他用户、Public 和重定向的用户配置位置。
    $moonProfilesKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList'
    $moonProfilesRoot = (Get-ItemProperty -LiteralPath $moonProfilesKey -ErrorAction SilentlyContinue).ProfilesDirectory
    if ($moonProfilesRoot) { $moonUserDirectories += [Environment]::ExpandEnvironmentVariables($moonProfilesRoot) }
    foreach ($moonProfile in Get-ChildItem -LiteralPath $moonProfilesKey -ErrorAction SilentlyContinue) {
        $moonImagePath = (Get-ItemProperty -LiteralPath $moonProfile.PSPath -ErrorAction SilentlyContinue).ProfileImagePath
        if ($moonImagePath) { $moonUserDirectories += [Environment]::ExpandEnvironmentVariables($moonImagePath) }
    }
    foreach ($moonUserDirectory in $moonUserDirectories) {
        if ([string]::IsNullOrWhiteSpace($moonUserDirectory)) { continue }
        $moonUserDirectory = [IO.Path]::GetFullPath($moonUserDirectory).TrimEnd('\')
        if ($moonInstallTarget.Equals($moonUserDirectory, [StringComparison]::OrdinalIgnoreCase) -or
            $moonInstallTarget.StartsWith($moonUserDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { exit 3 }
    }

    # 不跟随 junction/symlink；只给明确选中的应用根设置 ACL，不改变祖先。
    $moonAncestor = $moonInstallTarget
    while ($moonAncestor) {
        $moonExisting = Get-Item -LiteralPath $moonAncestor -Force -ErrorAction SilentlyContinue
        if ($moonExisting -and ($moonExisting.Attributes -band [IO.FileAttributes]::ReparsePoint)) { exit 4 }
        $moonParent = [IO.Path]::GetDirectoryName($moonAncestor)
        if ($moonParent -eq $moonAncestor) { break }
        $moonAncestor = $moonParent
    }

    $moonCurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $moonAllowedSids = @($moonCurrentUser.Value, 'S-1-5-18', 'S-1-5-32-544')
    $moonDirectory = Get-Item -LiteralPath $moonInstallTarget -Force -ErrorAction SilentlyContinue
    if ($moonDirectory -and -not $moonDirectory.PSIsContainer) { exit 2 }
    $moonNonEmpty = $moonDirectory -and (Get-ChildItem -LiteralPath $moonInstallTarget -Force | Select-Object -First 1)
    if ($moonNonEmpty) {
        $moonRegistered = $env:MOON_EXISTING_INSTALL_DIRECTORY
        if ([string]::IsNullOrWhiteSpace($moonRegistered) -or
            -not $moonInstallTarget.Equals([IO.Path]::GetFullPath($moonRegistered).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { exit 5 }
    } else {
        if (-not $moonDirectory) { $null = New-Item -ItemType Directory -Path $moonInstallTarget }
        # 新目录/明确选择的空目录成为专用应用根，阻止从宽松父目录继承权限。
        $moonAcl = [Security.AccessControl.DirectorySecurity]::new()
        # 当前用户已经拥有的新根只写 DACL；重复设置 Owner 会额外要求 WRITE_OWNER。
        $moonPriorOwner = [IO.Directory]::GetAccessControl($moonInstallTarget).GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($moonPriorOwner -ne $moonCurrentUser.Value) { $moonAcl.SetOwner($moonCurrentUser) }
        $moonAcl.SetAccessRuleProtection($true, $false)
        $moonInheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
        foreach ($moonSid in $moonAllowedSids) {
            $moonIdentity = [Security.Principal.SecurityIdentifier]::new($moonSid)
            $moonRule = [Security.AccessControl.FileSystemAccessRule]::new(
                $moonIdentity, [Security.AccessControl.FileSystemRights]::FullControl,
                $moonInheritance, [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow)
            $moonAcl.AddAccessRule($moonRule)
        }
        # 直接调用 .NET，避免子进程继承的模块路径触发 PowerShell.Security 自动加载失败。
        [IO.Directory]::SetAccessControl($moonInstallTarget, $moonAcl)
    }

    # 非空登记根只核验，不替用户修改已有目录权限。
    $moonActualAcl = [IO.Directory]::GetAccessControl($moonInstallTarget)
    if ($moonActualAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $moonCurrentUser.Value -or
        -not $moonActualAcl.AreAccessRulesProtected) { exit 7 }
    $moonCurrentFullControl = $false
    foreach ($moonRule in $moonActualAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($moonRule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) {
            if ($moonAllowedSids -notcontains $moonRule.IdentityReference.Value) { exit 7 }
            if ($moonRule.IdentityReference.Value -eq $moonCurrentUser.Value -and
                ($moonRule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) {
                $moonCurrentFullControl = $true
            }
        }
    }
    if (-not $moonCurrentFullControl) { exit 7 }
    # CreateNew + DeleteOnClose 只创建本次唯一探针，验证真实可写且不会误删旧文件。
    $moonProbe = Join-Path $moonInstallTarget ('.moon-install-' + [Guid]::NewGuid().ToString('N'))
    $moonStream = [IO.FileStream]::new($moonProbe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
        [IO.FileShare]::None, 1, [IO.FileOptions]::DeleteOnClose)
    try { $moonStream.WriteByte(0); $moonStream.Flush($true) } finally { $moonStream.Dispose() }
    exit 0
} catch {
    # 只向安装器返回错误类别，不输出目录内容或系统异常中的敏感信息。
    exit 6
}
