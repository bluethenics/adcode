# Uninstall ADCode

Close ADCode, then run the command for your installation in an external terminal.

Windows (installed desktop app, PowerShell; requires Windows Package Manager):

```powershell
winget uninstall --name ADCode
```

The installer includes the version in its registered name, so do not add `--exact`
to the unversioned name. If multiple copies match, use the full name shown by
`winget list --name ADCode` with `--exact` to select one.

If Windows Package Manager cannot find the installation, use **Settings > Apps >
Installed apps > ADCode > Uninstall**. For a portable copy, delete the downloaded
portable executable after closing it.

Linux installed from the Debian package:

```sh
sudo apt remove adcode
```

Linux installed as an AppImage by the website installer:

```sh
rm -- "$HOME/.local/bin/adcode"
```

Development CLI installed with `npm link`:

```sh
npm uninstall --global adcode
```

These commands remove the application or CLI. They do not delete your source
projects or your online ADCode account.
