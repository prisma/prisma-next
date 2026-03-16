Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/greenfield-setup-01-contract-emit:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/greenfield-setup/01-contract-emit.svg"
Output "recordings/ascii/greenfield-setup/01-contract-emit.ascii"

Hide
Type "# Emit contract.json + contract.d.ts [empty database, no contract yet]"
Enter
Show
Sleep 500ms
Type "prisma-next contract emit"
Sleep 300ms
Enter
Sleep 5s
