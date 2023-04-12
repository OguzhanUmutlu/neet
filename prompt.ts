#!/usr/bin/env node

const neet = require("./index");
const argLine = process.argv.slice(2).join(" ");
if (argLine) {
    neet.prompt(argLine).then(() => process.exit());
} else {
    const {stdin, stdout} = process;
    stdout.write("> ");
    stdin.resume();
    stdin.on("data", async (buffer: Buffer) => {
        if (neet.reading) return;
        const line = buffer.toString().replace("\r", "").replace("\n", "");
        stdin.pause();
        await neet.prompt(line === "\f" ? "cls" : line);
        stdin.resume();
        stdout.write("> ");
    });
}