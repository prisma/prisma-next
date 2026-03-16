Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/drift-phantom-03-db-schema-verify-fail:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/drift-phantom/03-db-schema-verify-fail.svg"
Output "recordings/ascii/drift-phantom/03-db-schema-verify-fail.ascii"

Hide
Type "# Schema verify catches the drift — missing email column [email column dropped, marker still matches contract]"
Enter
Show
Sleep 500ms
Type "prisma-next db schema-verify"
Sleep 300ms
Enter
Sleep 10s
