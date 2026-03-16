Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-08-db-introspect:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/08-db-introspect.svg"
Output "recordings/ascii/greenfield-setup/08-db-introspect.ascii"

Hide
Type "# Inspect the live database schema tree [initialized with user(id, email)]"
Enter
Show
Sleep 500ms
Type "prisma-next db introspect"
Sleep 300ms
Enter
Sleep 10s
