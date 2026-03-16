Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/drift-phantom-04-db-introspect-diverged:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/drift-phantom/04-db-introspect-diverged.svg"
Output "recordings/ascii/drift-phantom/04-db-introspect-diverged.ascii"

Hide
Type "# Introspect shows schema without email column [user table has only id column]"
Enter
Show
Sleep 500ms
Type "prisma-next db introspect"
Sleep 300ms
Enter
Sleep 10s
