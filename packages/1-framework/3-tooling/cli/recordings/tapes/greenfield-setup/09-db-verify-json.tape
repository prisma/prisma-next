Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-09-db-verify-json:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/09-db-verify-json.svg"
Output "recordings/ascii/greenfield-setup/09-db-verify-json.ascii"

Hide
Type "# Verify marker (JSON output for CI/agents) [initialized, marker matches contract]"
Enter
Show
Sleep 500ms
Type "prisma-next db verify --json"
Sleep 300ms
Enter
Sleep 10s
