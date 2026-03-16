Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-06-db-schema-verify:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/06-db-schema-verify.svg"
Output "recordings/ascii/greenfield-setup/06-db-schema-verify.ascii"

Hide
Type "# Verify schema satisfies contract (tolerant) [initialized, schema matches contract]"
Enter
Show
Sleep 500ms
Type "prisma-next db schema-verify"
Sleep 300ms
Enter
Sleep 10s
