Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/drift-phantom-05-db-update-fail:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/drift-phantom/05-db-update-fail.svg"
Output "recordings/ascii/drift-phantom/05-db-update-fail.ascii"

Hide
Type "# Recovery fails — cannot re-add NOT NULL column without default [email column missing, contract expects it]"
Enter
Show
Sleep 500ms
Type "prisma-next db update -y"
Sleep 300ms
Enter
Sleep 12s
