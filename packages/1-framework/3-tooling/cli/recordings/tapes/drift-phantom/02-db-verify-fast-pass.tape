Set Height 750
Source "recordings/tapes/shared-config.tape"
Env PATH "/Users/jkomyno/work/prisma/prisma-next/packages/1-framework/3-tooling/cli/recordings/.bin/drift-phantom-02-db-verify-fast-pass:/Users/jkomyno/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Output "recordings/svgs/drift-phantom/02-db-verify-fast-pass.svg"
Output "recordings/ascii/drift-phantom/02-db-verify-fast-pass.ascii"

Hide
Type "# Marker-only verification still passes — hash unchanged [email column dropped, marker row untouched]"
Enter
Show
Sleep 500ms
Type "prisma-next db verify --fast"
Sleep 300ms
Enter
Sleep 10s
