Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-02-db-init-dry-run:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/02-db-init-dry-run.svg"
Output "recordings/ascii/greenfield-setup/02-db-init-dry-run.ascii"

Hide
Type "# Preview planned CREATE TABLE operations [empty database, contract emitted]"
Enter
Show
Sleep 500ms
Type "prisma-next db init --dry-run"
Sleep 300ms
Enter
Sleep 12s
