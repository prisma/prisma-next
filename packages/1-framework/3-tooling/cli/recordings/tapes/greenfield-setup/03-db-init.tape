Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-03-db-init:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/03-db-init.svg"
Output "recordings/ascii/greenfield-setup/03-db-init.ascii"

Hide
Type "# Create tables and write contract marker [empty database, contract emitted]"
Enter
Show
Sleep 500ms
Type "prisma-next db init"
Sleep 300ms
Enter
Sleep 12s
