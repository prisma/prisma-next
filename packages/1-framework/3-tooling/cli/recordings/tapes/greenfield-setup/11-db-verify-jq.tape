Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-11-db-verify-jq:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/11-db-verify-jq.svg"
Output "recordings/ascii/greenfield-setup/11-db-verify-jq.ascii"

Hide
Type "# Pipe structured output to jq (auto-JSON when piped) [initialized, marker matches contract]"
Enter
Show
Sleep 500ms
Type "prisma-next db verify | jq '.contract'"
Sleep 300ms
Enter
Sleep 5s
