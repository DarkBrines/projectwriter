# projectwriter
By Raphaël Roumezin

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

To build for docker:

```bash
docker build . -t TAG:VERSION
```

## TODO list
- Add the possibility to create multiple boards at once
- Give visual feedback of the client being connected or not
- Send ping/pongs between server and clients
- All data storage is memory-based, so intergrate with databases
- Distribute the code through multiple files to make it more readable
