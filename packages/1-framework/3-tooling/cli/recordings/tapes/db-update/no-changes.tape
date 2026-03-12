Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/db-update-no-changes:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/db-update/no-changes.svg"
Output "recordings/ascii/db-update/no-changes.ascii"

Hide
Type "# No changes when database matches contract"
Enter
Show
Sleep 500ms
Type "prisma-next db update --dry-run"
Sleep 300ms
Enter
Sleep 15s
