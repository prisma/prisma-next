Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-05-db-verify:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/05-db-verify.svg"
Output "recordings/ascii/greenfield-setup/05-db-verify.ascii"

Hide
Type "# Verify marker hash matches contract [initialized, marker matches contract]"
Enter
Show
Sleep 500ms
Type "prisma-next db verify"
Sleep 300ms
Enter
Sleep 10s
