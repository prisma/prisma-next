Set Height 791
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next-clean/packages/1-framework/3-tooling/cli/recordings/.bin/db-update-additive-dry-run:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/db-update/additive-dry-run.svg"
Output "recordings/ascii/db-update/additive-dry-run.ascii"

Hide
Type "# Preview additive schema changes"
Enter
Show
Sleep 500ms
Type "prisma-next db update --dry-run"
Sleep 300ms
Enter
Sleep 15s
