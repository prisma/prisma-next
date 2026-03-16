Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/drift-phantom-01-db-verify-fail:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/drift-phantom/01-db-verify-fail.svg"
Output "recordings/ascii/drift-phantom/01-db-verify-fail.ascii"

Hide
Type "# Verify catches drift — structural schema check detects missing column [manual DDL dropped email column, marker untouched]"
Enter
Show
Sleep 500ms
Type "prisma-next db verify"
Sleep 300ms
Enter
Sleep 10s
