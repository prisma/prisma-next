Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-07-db-schema-verify-strict:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/07-db-schema-verify-strict.svg"
Output "recordings/ascii/greenfield-setup/07-db-schema-verify-strict.ascii"

Hide
Type "# Verify schema satisfies contract (strict, no extras) [initialized, schema matches contract exactly]"
Enter
Show
Sleep 500ms
Type "prisma-next db schema-verify --strict"
Sleep 300ms
Enter
Sleep 10s
