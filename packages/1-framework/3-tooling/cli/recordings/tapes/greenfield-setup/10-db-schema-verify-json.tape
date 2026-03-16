Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-10-db-schema-verify-json:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/10-db-schema-verify-json.svg"
Output "recordings/ascii/greenfield-setup/10-db-schema-verify-json.ascii"

Hide
Type "# Schema verification (JSON output for CI/agents) [initialized, schema matches contract]"
Enter
Show
Sleep 500ms
Type "prisma-next db schema-verify --json"
Sleep 300ms
Enter
Sleep 10s
