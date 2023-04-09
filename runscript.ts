const argv = process.argv.slice(2);
const exit = (str: string) => {
    console.log(str);
    process.exit();
};

if (!require("fs").existsSync("./cache.json")) exit("No cache was found.")

const script = require("./cache.json").scripts[argv[0]];

if (!argv[0]) exit("Usage: node runscript <scriptName>");

if (!script) exit("Couldn't find the script: " + argv[0]);

